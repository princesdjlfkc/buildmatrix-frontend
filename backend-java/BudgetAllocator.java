// BudgetAllocator.java
public class BudgetAllocator {
    
    public static void main(String[] args) {
        double totalBudget = 50000;
        
        if (args.length > 0) {
            try {
                totalBudget = Double.parseDouble(args[0]);
            } catch (NumberFormatException e) {
                totalBudget = 50000;
            }
        }
        
        double cpu = totalBudget * 0.25;
        double gpu = totalBudget * 0.35;
        double motherboard = totalBudget * 0.12;
        double ram = totalBudget * 0.08;
        double storage = totalBudget * 0.08;
        double psu = totalBudget * 0.07;
        double pcCase = totalBudget * 0.05;
        
        System.out.println("=== Budget Allocation for ₱" + String.format("%,.0f", totalBudget) + " ===");
        System.out.println("CPU: ₱" + String.format("%,.0f", cpu));
        System.out.println("GPU: ₱" + String.format("%,.0f", gpu));
        System.out.println("Motherboard: ₱" + String.format("%,.0f", motherboard));
        System.out.println("RAM: ₱" + String.format("%,.0f", ram));
        System.out.println("Storage: ₱" + String.format("%,.0f", storage));
        System.out.println("PSU: ₱" + String.format("%,.0f", psu));
        System.out.println("Case: ₱" + String.format("%,.0f", pcCase));
        System.out.println("Remaining: ₱" + String.format("%,.0f", totalBudget - (cpu + gpu + motherboard + ram + storage + psu + pcCase)));
    }
}