// 註冊 App 內的自訂 Plugin（Capacitor 不會自動掃描 App Target 裡的 Plugin）。
// 放在 App Target，並把 Main.storyboard 裡 Bridge View Controller 的 Custom Class 改成 MyViewController。

import Capacitor
import UIKit

class MyViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }
}
