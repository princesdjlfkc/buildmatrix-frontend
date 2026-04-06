public class BuildScoreCalculator {
    
    public static int calculateCompatibilityScore(
            boolean socketMatch, 
            boolean ramMatch, 
            boolean powerOk,
            boolean gpuFits) {
        
        int score = 100;
        if (!socketMatch) score -= 30;
        if (!ramMatch) score -= 20;
        if (!powerOk) score -= 25;
        if (!gpuFits) score -= 15;
        return Math.max(0, score);
    }
    
    public static String getGrade(int score) {
        if (score >= 90) return "A+ (Excellent)";
        if (score >= 80) return "A (Great)";
        if (score >= 70) return "B (Good)";
        if (score >= 60) return "C (Fair)";
        return "D (Needs Improvement)";
    }
    
    public static void main(String[] args) {
        // Default values
        boolean socketMatch = true;
        boolean ramMatch = true;
        boolean powerOk = true;
        boolean gpuFits = true;
        
        // Check if arguments are provided
        if (args.length >= 4) {
            socketMatch = args[0].equals("1");
            ramMatch = args[1].equals("1");
            powerOk = args[2].equals("1");
            gpuFits = args[3].equals("1");
        }
        
        int score = calculateCompatibilityScore(socketMatch, ramMatch, powerOk, gpuFits);
        String grade = getGrade(score);
        
        System.out.println("Score: " + score + "/100");
        System.out.println("Grade: " + grade);
        
        // Show breakdown if there are issues
        if (score < 100) {
            System.out.println("\nBreakdown:");
            if (!socketMatch) System.out.println("- Socket mismatch: -30");
            if (!ramMatch) System.out.println("- RAM mismatch: -20");
            if (!powerOk) System.out.println("- Power insufficient: -25");
            if (!gpuFits) System.out.println("- GPU too long for case: -15");
        }
    }
}