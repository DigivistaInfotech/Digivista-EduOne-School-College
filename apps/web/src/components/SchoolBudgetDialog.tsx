import { useState } from 'react';
import type { ProcurementBudget, Vendor } from '@erp/shared';
import { SCHOOL_EXPENSE_GROUPS, SCHOOL_EXPENSE_ITEMS, SCHOOL_DEPARTMENTS, SCHOOL_BUDGET_LOCATIONS, VENDOR_CATEGORIES } from '@erp/shared/procurement-catalog';
import { createBudget } from '../lib/endpoints';
import { Dialog } from './Dialog';
import { Alert, Button, Field, Input, Select } from './ui';

export function SchoolBudgetDialog({budget,years,vendors,error,saving,onClose,onSave}:{budget?:ProcurementBudget;years:Array<{id:string;name:string}>;vendors:Vendor[];error:string;saving:boolean;onClose:()=>void;onSave:(body:Parameters<typeof createBudget>[1])=>void}){
  const existingHead=SCHOOL_EXPENSE_ITEMS.find((item)=>item.code===budget?.expenseHeadCode||item.name===budget?.name);
  const legacy=!!budget&&!existingHead;
  const [academicYearId,setAcademicYearId]=useState(budget?.academicYearId??years[0]?.id??'');
  const [group,setGroup]=useState<string>(existingHead?.groupCode??(legacy?'existing':''));
  const [headCode,setHeadCode]=useState(existingHead?.code??(legacy?'existing':''));
  const [department,setDepartment]=useState(budget?.department??'Administration');
  const [floor,setFloor]=useState(budget?.floor??'');
  const [vendorId,setVendorId]=useState(budget?.vendorId??'');
  const [amount,setAmount]=useState(String(budget?.allocatedAmount??''));
  const [active,setActive]=useState(budget?.active??true);
  const selected=SCHOOL_EXPENSE_ITEMS.find((item)=>item.code===headCode);
  const locked=!!budget&&((budget.spentAmount??0)>0||(budget.committedAmount??0)>0);
  return <Dialog open onClose={onClose} title={budget?'Edit budget':'New budget'} description="Choose the school expense item, where it is used, and the allocation. No budget-name typing required." footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" form="budget-form" loading={saving}>Save budget</Button></>}>
    <form id="budget-form" className="space-y-4" onSubmit={(event)=>{event.preventDefault();if(!selected&&headCode!=='existing')return;onSave({academicYearId,name:selected?.name??budget!.name,department,expenseHeadCode:selected?.code??null,floor:floor||null,vendorId:vendorId||null,allocatedAmount:Number(amount),active});}}>
      {error&&<Alert tone="danger">{error}</Alert>}
      <Field label="Academic year" htmlFor="bud-year" required><Select id="bud-year" value={academicYearId} disabled={!!budget} onChange={(event)=>setAcademicYearId(event.target.value)} required><option value="">Select year</option>{years.map((year)=><option key={year.id} value={year.id}>{year.name}</option>)}</Select></Field>
      <Field label="Expense group" htmlFor="bud-group" required><Select id="bud-group" value={group} disabled={locked} onChange={(event)=>{const value=event.target.value;setGroup(value);setHeadCode(value==='existing'?'existing':'');const category=SCHOOL_EXPENSE_GROUPS.find((entry)=>entry.code===value);if(category&&!budget)setDepartment(category.department);}} required><option value="">Select expense group</option>{legacy&&<option value="existing">Existing budget (retain current name)</option>}{SCHOOL_EXPENSE_GROUPS.map((entry)=><option key={entry.code} value={entry.code}>{entry.name}</option>)}</Select></Field>
      <Field label="Expense item / head" htmlFor="bud-item" required><Select id="bud-item" value={headCode} disabled={!group||locked} onChange={(event)=>setHeadCode(event.target.value)} required><option value="">Select school expense item</option>{legacy&&group==='existing'&&<option value="existing">{budget?.name}</option>}{SCHOOL_EXPENSE_ITEMS.filter((item)=>item.groupCode===group).map((item)=><option key={item.code} value={item.code}>{item.name}</option>)}</Select></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Department / cost centre" htmlFor="bud-dept" required><Select id="bud-dept" value={department} disabled={locked} onChange={(event)=>setDepartment(event.target.value)} required>{department&&!SCHOOL_DEPARTMENTS.some((value)=>value===department)&&<option value={department}>{department} (existing)</option>}{SCHOOL_DEPARTMENTS.map((value)=><option key={value}>{value}</option>)}</Select></Field>
        <Field label="Location / area (optional)" htmlFor="bud-floor"><Select id="bud-floor" value={floor} disabled={locked} onChange={(event)=>setFloor(event.target.value)}><option value="">Not location-specific</option>{floor&&!SCHOOL_BUDGET_LOCATIONS.some((value)=>value===floor)&&<option>{floor}</option>}{SCHOOL_BUDGET_LOCATIONS.map((value)=><option key={value}>{value}</option>)}</Select></Field>
      </div>
      <Field label="Allocated to vendor (optional)" htmlFor="bud-vendor" hint="Leave unassigned if several vendors may supply this item."><Select id="bud-vendor" value={vendorId} disabled={locked} onChange={(event)=>setVendorId(event.target.value)}><option value="">Any supplier / service provider</option>{vendors.filter((vendor)=>vendor.status==='active'||vendor.id===vendorId).map((vendor)=><option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.category?` · ${VENDOR_CATEGORIES.find(([code])=>code===vendor.category)?.[1]??vendor.category}`:''}</option>)}</Select></Field>
      <Field label="Allocated amount (₹)" htmlFor="bud-amount" required><Input id="bud-amount" type="number" min={0} step="0.01" value={amount} onChange={(event)=>setAmount(event.target.value)} required/></Field>
      {locked&&<p className="text-xs text-slate-500">Transactions already exist. Change the allocation or active status here; create a new budget for a different head or cost centre.</p>}
      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={active} onChange={(event)=>setActive(event.target.checked)}/>Active</label>
    </form>
  </Dialog>;
}
