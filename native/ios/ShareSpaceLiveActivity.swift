// 即時動態與動態島的畫面。放在 ShareSpaceWidget（Widget Extension）Target。
// Xcode 建立 Widget Extension 時勾選「Include Live Activity」，再用這個檔案取代產生的範本；
// Widget Bundle（@main）裡改成只放 ShareSpaceLiveActivity()。

import ActivityKit
import SwiftUI
import WidgetKit

private let brand = Color(red: 0.31, green: 0.27, blue: 0.90) // #4f46e5
private let roomSymbol = "point.3.connected.trianglepath.dotted"

struct ShareSpaceLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShareSpaceAttributes.self) { context in
            // 鎖定畫面 / 不支援動態島的機型顯示的橫幅
            LockScreenView(attributes: context.attributes, state: context.state)
                .padding(16)
                .activityBackgroundTint(Color(.systemBackground).opacity(0.9))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text("#\(context.attributes.roomCode)").font(.headline.monospacedDigit())
                    } icon: {
                        Image(systemName: roomSymbol).foregroundStyle(brand)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Label("\(context.state.deviceCount)", systemImage: "iphone.gen3")
                        .font(.headline.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TransferRow(state: context.state, role: context.attributes.role)
                }
            } compactLeading: {
                Image(systemName: roomSymbol).foregroundStyle(statusColor(context.state.status))
            } compactTrailing: {
                if let progress = context.state.progress {
                    Text("\(Int(progress * 100))%").monospacedDigit().foregroundStyle(brand)
                } else {
                    Text("\(context.state.deviceCount)").monospacedDigit()
                }
            } minimal: {
                if let progress = context.state.progress {
                    ProgressView(value: progress).progressViewStyle(.circular).tint(brand)
                } else {
                    Image(systemName: roomSymbol).foregroundStyle(statusColor(context.state.status))
                }
            }
            .keylineTint(brand)
        }
    }
}

private func statusColor(_ status: String) -> Color {
    switch status {
    case "online": return .green
    case "reconnecting", "connecting", "starting": return .orange
    default: return .red
    }
}

private func statusText(_ status: String, role: String) -> String {
    switch status {
    case "online": return role == "host" ? "主控中" : "已連線"
    case "reconnecting": return "重新連線中"
    case "connecting", "starting": return "連線中"
    case "closed": return "空間已解散"
    default: return "已斷線"
    }
}

private struct TransferRow: View {
    let state: ShareSpaceAttributes.ContentState
    let role: String

    var body: some View {
        if let progress = state.progress {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: state.transferDirection == "up" ? "arrow.up.circle.fill" : "arrow.down.circle.fill")
                        .foregroundStyle(brand)
                    Text(state.transferName ?? "檔案").lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Text("\(Int(progress * 100))%").monospacedDigit()
                }
                .font(.subheadline)
                ProgressView(value: progress).tint(brand)
            }
        } else {
            HStack {
                Circle().fill(statusColor(state.status)).frame(width: 8, height: 8)
                Text(statusText(state.status, role: role)).font(.subheadline)
                Spacer()
            }
        }
    }
}

private struct LockScreenView: View {
    let attributes: ShareSpaceAttributes
    let state: ShareSpaceAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: roomSymbol).foregroundStyle(brand)
                Text("共享空間 #\(attributes.roomCode)").font(.headline.monospacedDigit())
                Spacer()
                Label("\(state.deviceCount) 台", systemImage: "iphone.gen3").font(.subheadline)
            }
            TransferRow(state: state, role: attributes.role)
        }
    }
}
