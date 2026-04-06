import java.util.*;

public class PriceCalculator {
    
    public static double calculateTotal(double[] prices) {
        double total = 0;
        for (double price : prices) {
            total += price;
        }
        return total;
    }
    
    public static String formatCurrency(double amount) {
        return String.format("₱%,.2f", amount);
    }
    
    public static Map<String, Double> suggestBudgetAllocation(double totalBudget) {
        Map<String, Double> allocation = new HashMap<>();
        allocation.put("CPU", totalBudget * 0.25);
        allocation.put("GPU", totalBudget * 0.35);
        allocation.put("Motherboard", totalBudget * 0.12);
        allocation.put("RAM", totalBudget * 0.08);
        allocation.put("Storage", totalBudget * 0.08);
        allocation.put("PSU", totalBudget * 0.07);
        allocation.put("Case", totalBudget * 0.05);
        return allocation;
    }
    
    public static void main(String[] args) {
        double[] prices = {7299, 23999, 6299, 4499, 4499, 5999, 3299};
        double total = calculateTotal(prices);
        System.out.println("Total: " + formatCurrency(total));
        
        System.out.println("\nBudget Allocation for ₱50,000:");
        Map<String, Double> allocation = suggestBudgetAllocation(50000);
        for (Map.Entry<String, Double> entry : allocation.entrySet()) {
            System.out.println(entry.getKey() + ": " + formatCurrency(entry.getValue()));
        }
    }
}