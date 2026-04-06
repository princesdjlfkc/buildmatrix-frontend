public class CompatibilityChecker {
    
    public static String checkSocket(String cpuSocket, String motherboardSocket) {
        if (cpuSocket == null || motherboardSocket == null) {
            return "⚠️ Missing socket information";
        }
        if (cpuSocket.equals(motherboardSocket)) {
            return "✅ CPU and Motherboard sockets match: " + cpuSocket;
        } else {
            return "❌ Socket mismatch: CPU uses " + cpuSocket + 
                   " but motherboard uses " + motherboardSocket;
        }
    }
    
    public static String checkPower(int cpuTdp, int gpuTdp, int psuWattage) {
        int total = cpuTdp + gpuTdp + 100;
        if (total > psuWattage) {
            return "❌ Power insufficient: Need " + total + "W, have " + psuWattage + "W";
        } else if (total > psuWattage * 0.8) {
            return "⚠️ Power close to limit: " + total + "W / " + psuWattage + "W";
        } else {
            return "✅ Power sufficient: " + total + "W / " + psuWattage + "W";
        }
    }
    
    public static String checkRAM(String ramType, String motherboardRAMType) {
        if (ramType == null || motherboardRAMType == null) {
            return "⚠️ RAM type unknown";
        }
        if (ramType.equals(motherboardRAMType)) {
            return "✅ RAM compatible: " + ramType;
        } else {
            return "❌ RAM mismatch: " + ramType + " vs " + motherboardRAMType;
        }
    }
    
    public static void main(String[] args) {
        // Test the compatibility checker
        System.out.println("=== BuildMatrix Compatibility Checker ===");
        System.out.println(checkSocket("AM5", "AM5"));
        System.out.println(checkPower(105, 200, 650));
        System.out.println(checkRAM("DDR5", "DDR5"));
    }
}