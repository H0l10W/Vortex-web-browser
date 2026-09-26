param([long]$WindowHandle, [int]$PointX, [int]$PointY)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CaptionHitTest {
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@
$point = (($PointY -band 65535) -shl 16) -bor ($PointX -band 65535)
[CaptionHitTest]::SendMessage([IntPtr]$WindowHandle, 0x84, [IntPtr]::Zero, [IntPtr]$point).ToInt64()
