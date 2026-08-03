; NSIS 自定义安装/卸载脚本
; 用于 electron-builder nsis.include

!macro customUninstall
  ; 删除 LibreOffice Portable 目录（如果用户按需下载过）
  ; ${APP_FILENAME} 由 electron-builder 注入，例如 "AI面试助手"
  RMDir /r "$PROFILE\AppData\Roaming\${APP_FILENAME}\libreoffice-portable"
  ; 删除残留的安装包
  Delete "$PROFILE\AppData\Roaming\${APP_FILENAME}\libreoffice-installer.exe"
  ; 删除 preferences 缓存
  Delete "$PROFILE\AppData\Roaming\${APP_FILENAME}\preferences.json"
!macroend
