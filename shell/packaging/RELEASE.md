Office for Apple Silicon Macs (macOS 13 or later).

1. Open the .dmg and drag Office to Applications.
2. The first time, macOS will not open it, because it is not from an identified developer: open
   System Settings > Privacy & Security, scroll down, and choose **Open Anyway** next to Office.
   (Or, in Terminal: `xattr -dr com.apple.quarantine /Applications/Office.app`.)
