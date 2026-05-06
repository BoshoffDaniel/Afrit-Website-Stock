[Setup]
AppName=Catalog Manager
AppVersion=1.0.0
AppPublisher=Kodexa
AppPublisherURL=https://kodexa.co.za
DefaultDirName={autopf}\CatalogManager
DefaultGroupName=Catalog Manager
OutputBaseFilename=CatalogManager_Setup
OutputDir=installer_output
Compression=lzma2
SolidCompression=yes
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\CatalogManager.exe
PrivilegesRequired=admin

[Dirs]
Name: "{commonappdata}\CatalogManager"
Name: "{commonappdata}\CatalogManager\static"
Name: "{commonappdata}\CatalogManager\static\uploads"
Name: "{commonappdata}\CatalogManager\camera_inbox"
Name: "{commonappdata}\CatalogManager\exports"

[Files]
Source: "dist\CatalogManager\*"; DestDir: "{app}"; Flags: recursesubdirs

[Icons]
Name: "{group}\Catalog Manager"; Filename: "{app}\CatalogManager.exe"
Name: "{commondesktop}\Catalog Manager"; Filename: "{app}\CatalogManager.exe"

[Run]
Filename: "{app}\CatalogManager.exe"; Description: "Launch Catalog Manager"; Flags: postinstall nowait skipifsilent
