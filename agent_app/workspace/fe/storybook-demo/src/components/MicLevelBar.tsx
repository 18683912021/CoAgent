/**
 * MicLevelBar —— 麦克风音量条
 *
 * 10 格电平，level 0~100 控制亮起几格。
 * animated 打开时自动模拟"说话"的音量波动（demo 用）。
 * 低音量绿色 → 中音量橙色 → 高音量红色。
 */
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface Props {
  level?: number; // 0 ~ 100
  animated?: boolean; // 自动模拟音量波动
}

const BAR_COUNT = 10;

export default function MicLevelBar({ level = 0, animated = false }: Props) {
  const [levelNow, setLevelNow] = useState(level);

  // 模拟真实说话的音量：随机上下波动
  useEffect(() => {
    if (!animated) return;
    setLevelNow(level);
    const timer = setInterval(() => {
      setLevelNow(30 + Math.random() * 65);
    }, 150);
    return () => clearInterval(timer);
  }, [animated, level]);

  const activeBars = Math.round((Math.max(0, Math.min(100, levelNow)) / 100) * BAR_COUNT);

  return (
    <div className="flex items-end gap-1 h-10">
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const on = i < activeBars;
        const ratio = (i + 1) / BAR_COUNT;
        const color =
          ratio <= 0.5
            ? 'bg-success'
            : ratio <= 0.8
              ? 'bg-warning'
              : 'bg-danger';
        return (
          <motion.span
            key={i}
            animate={{
              height: on ? `${20 + ((i % 3) + 1) * 18}%` : '14%',
              opacity: on ? 1 : 0.25,
            }}
            transition={{ duration: 0.12 }}
            className={`w-2 rounded-full ${color}`}
          />
        );
      })}
    </div>
  );
}
