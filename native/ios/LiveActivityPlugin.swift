// Capacitor 自訂 Plugin：讓網頁端呼叫 ActivityKit 啟動 / 更新 / 結束即時動態。
// JS 端：src/native/liveActivity.js（registerPlugin('LiveActivity')）
// 放在 App Target，並在 MyViewController.capacitorDidLoad() 註冊。

import ActivityKit
import Capacitor
import Foundation

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    /// Activity 型別需要 iOS 16.2+，App 最低支援 iOS 15，所以用 Any 存放
    private var current: Any?

    private static func state(from call: CAPPluginCall) -> ShareSpaceAttributes.ContentState {
        ShareSpaceAttributes.ContentState(
            status: call.getString("status", "online"),
            deviceCount: call.getInt("deviceCount", 1),
            transferName: call.getString("transferName"),
            transferDirection: call.getString("transferDirection"),
            progress: call.getDouble("progress")
        )
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), ActivityAuthorizationInfo().areActivitiesEnabled else {
            return call.resolve() // 舊系統或使用者關閉即時動態：靜默略過
        }
        let attributes = ShareSpaceAttributes(roomCode: call.getString("roomCode", ""), role: call.getString("role", "client"))
        let content = ActivityContent(state: Self.state(from: call), staleDate: nil)
        Task {
            // 同時只保留一個（例如 Host 恢復時換了代碼）
            for activity in Activity<ShareSpaceAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            do {
                current = try Activity.request(attributes: attributes, content: content, pushType: nil)
                call.resolve()
            } catch {
                call.reject("無法啟動即時動態", nil, error)
            }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let activity = current as? Activity<ShareSpaceAttributes> else {
            return call.resolve()
        }
        let content = ActivityContent(state: Self.state(from: call), staleDate: nil)
        Task {
            await activity.update(content)
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let activity = current as? Activity<ShareSpaceAttributes> else {
            return call.resolve()
        }
        current = nil
        Task {
            await activity.end(nil, dismissalPolicy: .immediate)
            call.resolve()
        }
    }
}
