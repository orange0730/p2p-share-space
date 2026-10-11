// 即時動態的資料結構。
// ⚠️ 這個檔案要同時勾選兩個 Target Membership：App（App）與 ShareSpaceWidget（Widget Extension）。
// 欄位要和 src/native/liveActivity.js 的 toLiveState() 對應。

import ActivityKit
import Foundation

struct ShareSpaceAttributes: ActivityAttributes {
    /// 會隨時間變化的內容（每次 update 送過來）
    public struct ContentState: Codable, Hashable {
        /// "online" | "starting" | "connecting" | "reconnecting" | "disconnected" | "error"
        var status: String
        var deviceCount: Int
        /// 進行中的傳輸（沒有傳輸時為 nil）
        var transferName: String?
        /// "up" | "down"
        var transferDirection: String?
        /// 0...1
        var progress: Double?
    }

    /// 啟動後不會變的內容
    var roomCode: String
    /// "host" | "client"
    var role: String
}
