import type { ProcurementBudget } from './modules';
export interface BudgetTransaction {
  id:string;source:'expense'|'paid_bill';budgetId:string|null;budgetName:string;expenseHeadCode:string|null;
  department:string|null;location:string|null;vendorName:string|null;description:string;amount:number;date:string;
  status:'approved'|'recorded';poId:string|null;
}
export interface BudgetCommitment {id:string;budgetId:string|null;poNumber:string;vendorName:string;amount:number}
export interface BudgetReport {
  academicYearId:string|null;academicYearName:string;
  totals:{allocated:number;actual:number;pending:number;committed:number;available:number;overspent:number;unallocatedActual:number};
  budgets:Array<ProcurementBudget & {pendingAmount:number}>;
  transactions:BudgetTransaction[];commitments:BudgetCommitment[];
}
