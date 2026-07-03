// A minimal top bar drawn as a wlr-layer-shell surface on gnoblin. gnoblin strips
// GNOME's own top bar, so this is what you actually see. Deliberately small — a
// starting point to build your own chrome on.

import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Wayland
import "../services" as Services

PanelWindow {
    id: bar

    // Variants feeds each delegate its per-screen data as `modelData`; bind the
    // window to that screen so there's one bar per monitor.
    property var modelData
    screen: modelData

    // Identify to gnoblin's window-rules by namespace (quickshell:<name>).
    WlrLayershell.namespace: "quickshell:bar"
    WlrLayershell.layer: WlrLayer.Top

    anchors { top: true; left: true; right: true }
    implicitHeight: 34
    color: "transparent"

    Rectangle {
        anchors.fill: parent
        color: "#1e1e2e"

        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 12
            anchors.rightMargin: 12
            spacing: 12

            // left: a gnoblin badge that soft-reloads on click
            Text {
                text: "gnoblin"
                color: "#cdd6f4"
                font.pixelSize: 13
                font.bold: true
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Services.Gnoblin.reload()   // Wayland soft-reload; windows survive
                }
            }

            Item { Layout.fillWidth: true }

            // right: clock
            Text {
                id: clock
                color: "#cdd6f4"
                font.pixelSize: 13
                Timer {
                    interval: 1000; running: true; repeat: true
                    triggeredOnStart: true
                    onTriggered: clock.text = Qt.formatDateTime(new Date(), "ddd d MMM  HH:mm")
                }
            }
        }
    }
}
