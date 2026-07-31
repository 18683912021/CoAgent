"""
PDF→DOCX 增强转换：PyMuPDF 提取文字+视觉元素 + DeepSeek 全量样式分析 + python-docx 重建。

v3: 加入横线/色块等视觉元素提取 + 精确坐标间距计算。
"""

from __future__ import annotations

import io, json, logging, os, re
from dataclasses import dataclass

import fitz
import httpx
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

logger = logging.getLogger("pdf2docx_llm")

_STYLE_PROMPT = """你是文档排版专家。分析 PDF 提取的文字行和视觉元素，输出完整样式 JSON。

文字行：[id=N pg=P x=X y=Y w=W sz=S B/b] "text..."
视觉元素：
  H-line(y, x0-x1, color, thick)           → 水平线（分隔线、下划线）
  Rect(x0,y0,x1,y1, fill=色, thick)        → 矩形色块（标题背景、装饰条）
  Image(x0,y0,x1,y1, thick=高度)           → 图片（照片、logo、图标）

输出 JSON（不要 markdown）：
{
  "title": "标题文字",
  "design": {"body_font":"SimSun","heading_font":"SimHei","body_size":10.5,"body_color":"#333333"},
  "blocks": [
    {"type":"photo","y":100,"w":80,"h":100,"align":"center","border":true},
    {"ids":[1],"type":"heading","level":1,"size":22,"bold":true,"color":"#1A3A6B","align":"center"},
    {"type":"separator","color":"#1A3A6B","thickness":3},
    {"ids":[2,3],"type":"info_bar","size":9.5,"color":"#666666","align":"center"},
    {"ids":[5],"type":"heading","level":2,"size":14,"bold":true,"color":"#FFFFFF","align":"left","bar_color":"#2B579A"},
    {"ids":[6,7,8],"type":"paragraph","size":10.5,"color":"#333333","align":"left","first_line_indent":true},
    {"ids":[12,13,14],"type":"list","ordered":false,"size":10.5,"color":"#333333"}
  ]
}

视觉元素处理规则：
1. 图片(Image)：照片/头像→ type:"photo"；logo→ type:"logo"；图标→ type:"icon"
   描述其位置(y坐标)和尺寸(w/h)，DOCX 中作为居中的嵌入式图片
2. 横线(H-line)：分隔线→ type:"separator"；标题下划线装饰→ type:"separator"
3. 矩形色块(Rect)：紧靠在标题上方/下方的→ 标题的 bar_color
   独立的装饰色块→ type:"decoration_bar"，描述其颜色和位置

文字块处理规则：
- 标题识别：字号明显大于正文 + 粗体/颜色不同 → heading。level 按字号分 1/2/3
- 段落合并：y 连续、字号相同、x 一致 → 同一 paragraph
- 信息栏：像 "电话:xxx | 邮箱:xxx | 地址:xxx" 这种并列短行 → type:"info_bar"
- bar_color：标题有深色背景时必填（16 进制色值，#RRGGBB）
- 颜色保留实际值；黑色系(#000/#333)统一为 #333333；白色文字保留 #FFFFFF
- 中文字体 SimSun/SimHei，英文 Arial
- 间距由程序精确计算，你不要填 space_before/after
- 严禁 text 字段，只输出 ids
- 只输出 JSON"""


@dataclass
class RawLine:
    id: int; text: str
    x: float; y: float; y2: float; w: float
    size: float; bold: bool; color: str


@dataclass
class VisualElem:
    type: str       # "hline" | "rect"
    y: float        # 用于排序
    bbox: tuple[float, float, float, float]
    color: str      # hex
    thickness: float = 1.0


class PDFToDOCXLLMConverter:

    def __init__(self, pdf_bytes: bytes):
        self._pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        self._api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self._api_url = "https://api.deepseek.com/v1/chat/completions"

    async def convert(self) -> bytes:
        if not self._api_key:
            raise RuntimeError("ANTHROPIC_API_KEY 未配置")

        lines, visuals = self._extract_all()
        if not lines and not visuals:
            buf = io.BytesIO(); Document().save(buf); return buf.getvalue()

        style_spec = await self._analyze(lines, visuals)
        return self._build_docx(style_spec, lines, visuals)

    # ── 提取 ──────────────────────────────────────────────

    def _extract_all(self) -> tuple[list[RawLine], list[VisualElem]]:
        lines: list[RawLine] = []
        visuals: list[VisualElem] = []
        lid = 0

        for pn in range(len(self._pdf_doc)):
            page = self._pdf_doc[pn]
            # 文字
            pd = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
            for block in pd.get("blocks", []):
                if block.get("type") != 0: continue
                for line in block.get("lines", []):
                    spans = line.get("spans", [])
                    if not spans: continue
                    text = "".join(s.get("text","") for s in spans)
                    if not text.strip(): continue
                    s0 = spans[0]; bbox = line["bbox"]
                    lid += 1
                    lines.append(RawLine(id=lid, text=text, x=bbox[0], y=bbox[1],
                                         y2=bbox[3], w=bbox[2]-bbox[0],
                                         size=s0.get("size",10),
                                         bold=bool(s0.get("flags",0)&8),
                                         color=f"#{s0.get('color',0):06X}"))

            # 视觉元素：全部推给 DeepSeek 判断
            try:
                drawings = page.get_drawings()
            except Exception:
                continue
            for d in drawings:
                r = d["rect"]
                w = r.x1 - r.x0; h = r.y1 - r.y0
                fill = d.get("fill", "")
                fill_hex = _rgba_to_hex(fill) if fill else ""
                stroke = d.get("color", "")
                stroke_hex = _rgba_to_hex(stroke) if stroke else ""
                opacity = d.get("fill_opacity", 1.0)

                # 跳过不可见的元素
                if opacity < 0.05 and not stroke:
                    continue
                # 跳过极小点（通常是 PDF 渲染噪声）
                if w < 2 and h < 2:
                    continue

                if h < 6 and w > 100:
                    # 横线条：分隔线或下划线装饰
                    color = fill_hex or stroke_hex or "#CCCCCC"
                    visuals.append(VisualElem("hline", r.y0, (r.x0,r.y0,r.x1,r.y1), color, h))
                elif fill and opacity > 0.1:
                    # 有色块
                    visuals.append(VisualElem("rect", r.y0, (r.x0,r.y0,r.x1,r.y1), fill_hex, h))
                elif stroke and not fill:
                    # 只有边框（可能是框线或图片占位框）
                    visuals.append(VisualElem("rect", r.y0, (r.x0,r.y0,r.x1,r.y1), stroke_hex, h))

            # 图片提取
            img_list = page.get_images(full=True)
            for img_info in img_list:
                xref = img_info[0]
                rects = page.get_image_rects(xref)
                for rect in rects:
                    if rect.is_empty or rect.is_infinite:
                        continue
                    visuals.append(VisualElem("image", rect.y0,
                        (rect.x0, rect.y0, rect.x1, rect.y1), "#000000",
                        rect.y1 - rect.y0))

        # 按 y 排序
        visuals.sort(key=lambda v: v.y)
        return lines, visuals

    # ── DeepSeek ──────────────────────────────────────────

    async def _analyze(self, lines: list[RawLine], visuals: list[VisualElem]) -> dict:
        pg_count = len(self._pdf_doc)
        pg_w = int(self._pdf_doc[0].rect.width) if pg_count > 0 else 595

        parts = [f"文档{pg_count}页，宽{pg_w}pt。\n"]

        # 视觉元素
        if visuals:
            parts.append("视觉元素：")
            for v in visuals:
                if v.type == "hline":
                    parts.append(f"  H-line(y={v.y:.0f}, {v.bbox[0]:.0f}-{v.bbox[2]:.0f}, color={v.color}, thick={v.thickness:.0f})")
                else:
                    parts.append(f"  V-rect({v.bbox[0]:.0f},{v.bbox[1]:.0f},{v.bbox[2]:.0f},{v.bbox[3]:.0f}, fill={v.color})")

        # 文字行
        parts.append("文字行：")
        chars = 0
        for l in lines:
            desc = f'[id={l.id} x={l.x:.0f} y={l.y:.0f} w={l.w:.0f} sz={l.size:.1f} {"B" if l.bold else "b"}] "{l.text[:80]}"'
            if chars + len(desc) > 40000: break
            parts.append(desc)
            chars += len(desc)

        user_msg = "\n".join(parts)
        logger.info("DeepSeek 分析: %d lines + %d visuals, %d chars", len(lines), len(visuals), chars)

        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0)) as client:
            resp = await client.post(self._api_url, json={
                "model": "deepseek-chat",
                "messages": [{"role":"system","content":_STYLE_PROMPT},{"role":"user","content":user_msg}],
                "stream": False, "max_tokens": 8000, "temperature": 0.1,
            }, headers={"Authorization":f"Bearer {self._api_key}","Content-Type":"application/json"})
            if resp.status_code != 200:
                raise RuntimeError(f"DeepSeek API {resp.status_code}")
            content = resp.json()["choices"][0]["message"]["content"]
            logger.info("DeepSeek 回复: %.500s", content)
        return _parse_json(content)

    # ── DOCX 重建 ─────────────────────────────────────────

    def _build_docx(self, spec: dict, lines: list[RawLine], visuals: list[VisualElem]) -> bytes:
        doc = Document()
        doc.sections[0].page_width = Cm(21.0)
        doc.sections[0].page_height = Cm(29.7)

        design = spec.get("design", {})
        body_font = design.get("body_font", "SimSun")
        h_font = design.get("heading_font", "SimHei")
        body_sz = design.get("body_size", 10.5)
        body_clr = design.get("body_color", "#333333")

        line_db = {l.id: l for l in lines}
        # 按 y 排序的 visuals 查找表
        visuals_sorted = sorted(visuals, key=lambda v: v.y)
        used_visuals: set[int] = set()

        def _text(ids: list[int]) -> str:
            parts = []
            for lid in ids:
                ln = line_db.get(lid)
                if ln: parts.append(ln.text)
            return "".join(parts)

        def _add_run(para, text, font, size, bold, color):
            r = para.add_run(text)
            r.font.name = font; r.font.size = Pt(size)
            r.bold = bold
            try:
                r.font.color.rgb = RGBColor(int(color[1:3],16), int(color[3:5],16), int(color[5:7],16))
            except: pass
            return r

        def _spacing(para, before, after):
            pf = para.paragraph_format
            pf.space_before = Pt(before); pf.space_after = Pt(after)

        def _add_separator(color="#CCCCCC", thick=1):
            p = doc.add_paragraph()
            _spacing(p, 4, 4)
            pPr = p._p.get_or_add_pPr()
            pBdr = OxmlElement('w:pBdr')
            bot = OxmlElement('w:bottom')
            for attr, val in [('w:val','single'),('w:sz',str(thick*4)),('w:space','1'),('w:color',color.lstrip('#'))]:
                bot.set(qn(attr), val)
            pBdr.append(bot); pPr.append(pBdr)

        def _add_bar(para, color):
            """段落背景色块"""
            pPr = para._p.get_or_add_pPr()
            shd = OxmlElement('w:shd')
            shd.set(qn('w:val'), 'clear')
            shd.set(qn('w:fill'), color.lstrip('#'))
            pPr.append(shd)

        def _align(para, a):
            m = {"left":0,"center":1,"right":2,"justify":3}
            para.alignment = m.get(a, 0)

        # === 渲染 ===
        title = spec.get("title")
        if title:
            p = doc.add_paragraph(); _align(p, "center"); _spacing(p, 0, 16)
            _add_run(p, title, h_font, 22, True, "#000000")

        blocks = spec.get("blocks", [])

        # 完整性检查：找出未被任何 block 覆盖的行
        covered_ids: set[int] = set()
        for b in blocks:
            for lid in b.get("ids", []):
                covered_ids.add(lid)
        orphan_ids = sorted(set(line_db.keys()) - covered_ids)

        # 将孤儿行插入到 blocks 的正确位置（按 y 坐标）
        for oid in orphan_ids:
            ln = line_db[oid]
            # 在 blocks 中找到插入位置
            insert_at = len(blocks)
            for bi, b in enumerate(blocks):
                bids = b.get("ids", [])
                if bids:
                    bl = line_db.get(bids[0])
                    if bl and ln.y < bl.y:
                        insert_at = bi; break
            blocks.insert(insert_at, {"ids": [oid], "type": "paragraph",
                           "size": ln.size, "bold": ln.bold, "color": ln.color, "align": "left"})

        # 全量重排 blocks（按第一个 id 的 y 坐标）
        def _block_y(b):
            ids = b.get("ids", [])
            if ids:
                ll = line_db.get(ids[0])
                return ll.y if ll else 9999
            return b.get("_sort_y", 9999)
        # 标记视觉 blocks 的 sort_y
        for b in blocks:
            if not b.get("ids") and b.get("type") in ("separator","photo","logo","icon","decoration_bar"):
                b["_sort_y"] = b.get("y", 0)
        blocks.sort(key=_block_y)

        # 渲染每个 block
        last_bottom: float = 0.0  # 追踪上一个渲染元素底部
        for bi, block in enumerate(blocks):
            btype = block.get("type", "paragraph")
            ids = block.get("ids", [])

            # 精确间距：基于上一个元素底部 vs 当前第一行顶部
            if ids:
                fl = line_db.get(ids[0])
                space_before = max(0, (fl.y if fl else 0) - last_bottom) if last_bottom > 0 else 6
            elif btype in ("separator","photo","logo","icon","decoration_bar"):
                space_before = max(0, block.get("y", last_bottom) - last_bottom) if last_bottom > 0 else 6
            else:
                space_before = 6

            # ── 视觉类型（无文字）──
            if btype in ("separator",):
                _add_separator(block.get("color","#CCCCCC"), block.get("thickness",1))
                continue

            if btype in ("photo", "logo", "icon"):
                self._add_image_block(doc, block, visuals_sorted, used_visuals, page_w=595)
                continue

            if btype in ("decoration_bar",):
                p = doc.add_paragraph()
                bar_c = block.get("color", "#2B579A")
                _add_bar(p, bar_c)
                _spacing(p, 0, 0)
                continue

            if btype == "info_bar":
                text = _text(ids)
                p = doc.add_paragraph(); _align(p, block.get("align","center"))
                _spacing(p, space_before, 4)
                _add_run(p, text, body_font, block.get("size",9.5), False, block.get("color","#666666"))
                continue

            # ── 文字类型 ──
            if btype == "heading":
                text = _text(ids)
                p = doc.add_paragraph(); _align(p, block.get("align","left"))
                _spacing(p, space_before, 4)
                bar_c = block.get("bar_color")
                if bar_c:
                    _add_bar(p, bar_c)
                    txt_c = _contrast_color(bar_c)
                else:
                    txt_c = block.get("color", body_clr)
                lvl = block.get("level", 2)
                sz_map = {1: 18, 2: 15, 3: 13}
                _add_run(p, text, h_font, sz_map.get(lvl, 15), True, txt_c)
                continue

            if btype == "paragraph":
                text = _text(ids)
                p = doc.add_paragraph(); _align(p, block.get("align","left"))
                _spacing(p, space_before, 2)
                if block.get("first_line_indent"):
                    p.paragraph_format.first_line_indent = Cm(0.74)
                _add_run(p, text, body_font, block.get("size",body_sz),
                         block.get("bold",False), block.get("color",body_clr))
                continue

            if btype == "list":
                ordered = block.get("ordered", False)
                for i, lid in enumerate(ids):
                    ln = line_db.get(lid)
                    if not ln: continue
                    p = doc.add_paragraph()
                    p.paragraph_format.left_indent = Cm(1.0)
                    _spacing(p, 1, 1)
                    prefix = f"{i+1}. " if ordered else "• "
                    _add_run(p, prefix + ln.text, body_font, block.get("size",body_sz),
                             False, block.get("color",body_clr))
                doc.add_paragraph()
                continue

            # 更新追踪：记录此 block 底部位置
            if ids:
                ll = line_db.get(ids[-1])
                if ll: last_bottom = ll.y2
            elif btype in ("separator",):
                last_bottom = block.get("y", last_bottom) + block.get("thickness", 2)
            elif btype in ("photo","logo","icon"):
                last_bottom = block.get("y", last_bottom) + block.get("h", 50)
            elif btype in ("decoration_bar",):
                last_bottom = block.get("y", last_bottom) + 8

        buf = io.BytesIO(); doc.save(buf); return buf.getvalue()

    def _add_image_block(self, doc, block, visuals_sorted, used_visuals, page_w=595):
        """在 DOCX 中嵌入图片。"""
        target_y = block.get("y", 0)
        best_vi = None
        for vi, v in enumerate(visuals_sorted):
            if vi in used_visuals or v.type != "image": continue
            if abs(v.y - target_y) < 25:
                best_vi = vi; break
        if best_vi is None:
            p = doc.add_paragraph(); p.alignment = 1; return

        used_visuals.add(best_vi)
        x0, y0, x1, y1 = visuals_sorted[best_vi].bbox
        for pn in range(len(self._pdf_doc)):
            for info in self._pdf_doc[pn].get_images(full=True):
                xref = info[0]
                for rect in self._pdf_doc[pn].get_image_rects(xref):
                    if abs(rect.y0 - y0) < 5 and abs(rect.x0 - x0) < 5:
                        try:
                            img_bytes = self._pdf_doc.extract_image(xref).get("image")
                            if img_bytes:
                                p = doc.add_paragraph(); p.alignment = 1
                                p.add_run().add_picture(io.BytesIO(img_bytes),
                                    width=Cm(min((x1-x0)/72*2.54, 5.0)))
                                doc.add_paragraph()
                                return
                        except Exception:
                            pass
        p = doc.add_paragraph(); p.alignment = 1


# ── 工具函数 ────────────────────────────────────────────

def _rgba_to_hex(rgba) -> str:
    """PyMuPDF 颜色 → #RRGGBB"""
    if isinstance(rgba, (list, tuple)) and len(rgba) >= 3:
        return f"#{int(rgba[0]*255):02X}{int(rgba[1]*255):02X}{int(rgba[2]*255):02X}"
    return "#CCCCCC"


def _contrast_color(bg_hex: str) -> str:
    """深色背景返回白色文字，浅色返回黑色"""
    try:
        r = int(bg_hex[1:3], 16); g = int(bg_hex[3:5], 16); b = int(bg_hex[5:7], 16)
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        return "#FFFFFF" if lum < 128 else "#000000"
    except:
        return "#000000"


def _parse_json(content: str) -> dict:
    content = content.strip()
    m = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', content, re.DOTALL)
    if m: content = m.group(1)
    return json.loads(content)
