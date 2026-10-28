!macro customHeader
  !ifdef BUILD_UNINSTALLER
    !define MUI_WELCOMEPAGE_TITLE "卸载影盒"
    !define MUI_WELCOMEPAGE_TEXT "将从您的计算机移除影盒。$\r$\n$\r$\n确定要继续吗？"
    !define MUI_FINISHPAGE_TITLE "卸载完成"
    !define MUI_FINISHPAGE_TEXT "影盒已从您的计算机移除。$\r$\n$\r$\n点击 [完成] 退出卸载程序。"
  !else
    !define MUI_DIRECTORYPAGE_TEXT_TOP "请指定影盒的安装路径。"
    !define MUI_DIRECTORYPAGE_TEXT_DESTINATION "目标文件夹"
    !define MUI_FINISHPAGE_TITLE "安装完成"
    !define MUI_FINISHPAGE_TEXT "影盒已成功安装到您的计算机。$\r$\n$\r$\n点击 [完成] 退出安装程序。"
  !endif
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎使用影盒"
  !define MUI_WELCOMEPAGE_TEXT "这将指导您完成影盒的安装。$\r$\n$\r$\n单击 [下一步] 继续。"
  !insertmacro MUI_PAGE_WELCOME
!macroend
