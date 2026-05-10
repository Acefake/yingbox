!macro customHeader
  !define MUI_TEXT_INSTALLER_TITLE "影盒 安装程序"
  !define MUI_TEXT_INSTALLER_SUBTITLE "影盒 - 影视资源管理与在线观看"
!macroend

!macro customInstallMode
  !define MUI_TEXT_INSTALL_MODE_TITLE "选择安装方式"
  !define MUI_TEXT_INSTALL_MODE_SUBTITLE "请选择影盒的安装方式"
!macroend

!macro customDirectoryPage
  !define MUI_DIRECTORYPAGE_TEXT_TOP "请指定影盒的安装路径。$$
$$
安装文件夹："
  !define MUI_DIRECTORYPAGE_TEXT_DESTINATION "目标文件夹"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎使用影盒"
  !define MUI_WELCOMEPAGE_TEXT "这将指导您完成影盒的安装。$$
$$
$$
$_CLICK"
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "安装完成"
  !define MUI_FINISHPAGE_TEXT "影盒已成功安装到您的计算机。$$
$$
点击 [完成] 退出安装程序。"
!macroend

!macro customUninstallWelcome
  !define MUI_UNCONFIRMPAGE_TITLE "卸载影盒"
  !define MUI_UNCONFIRMPAGE_TEXT_TOP "将从您的计算机移除影盒。$$
$$
确定要继续吗？"
!macroend

!macro customUninstallFinish
  !define MUI_UNFINISHPAGE_TITLE "卸载完成"
  !define MUI_UNFINISHPAGE_TEXT "影盒已从您的计算机移除。$$
$$
点击 [完成] 退出卸载程序。"
!macroend

; 自定义开始菜单文件夹名称
!define MUI_STARTMENUPAGE_DEFAULTFOLDER "影盒"
