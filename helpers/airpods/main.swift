// AirPods / Beats head tracking -> OpenTrack UDP (127.0.0.1:4242) for helpers/head_bridge.py.
// Needs macOS 14+ and headphones with head tracking (AirPods Pro, AirPods 3/4, AirPods Max, Beats Fit Pro).
// The AirPods must be the Mac's current sound output: they only send motion to the device playing audio.
//
// Build (Info.plist is embedded so macOS can ask for Motion permission):
//   swiftc -O helpers/airpods/main.swift -o airpods-opentrack \
//     -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker helpers/airpods/Info.plist
// Run:  ./airpods-opentrack   (and python helpers/head_bridge.py in another terminal)
import CoreMotion
import Foundation
import Network

guard #available(macOS 14.0, *) else {
    print("Headphone head tracking needs macOS 14 or later.")
    exit(1)
}

let motion = CMHeadphoneMotionManager()
guard motion.isDeviceMotionAvailable else {
    print("Head tracking is not available on this Mac.")
    exit(1)
}

let udp = NWConnection(host: "127.0.0.1", port: 4242, using: .udp)
udp.start(queue: .main)

motion.startDeviceMotionUpdates(to: .main) { sample, error in
    if let error {
        print("Motion error: \(error.localizedDescription). Allow Motion access in System Settings › Privacy & Security.")
        return
    }
    guard let a = sample?.attitude else { return }
    let deg = 180 / Double.pi
    // OpenTrack: x, y, z (cm), yaw (right +), pitch, roll (deg) as little-endian doubles.
    // CoreMotion yaw is left +, so it is negated.
    let values: [Double] = [0, 0, 0, -a.yaw * deg, a.pitch * deg, a.roll * deg]
    let packet = values.withUnsafeBufferPointer { Data(buffer: $0) } // Apple CPUs are little-endian
    udp.send(content: packet, completion: .idempotent)
}

print("Streaming AirPods head tracking to OpenTrack 127.0.0.1:4242. Press Ctrl+C to stop.")
dispatchMain()
