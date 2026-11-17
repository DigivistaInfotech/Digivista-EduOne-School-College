import { SCHOOL_EXPENSE_GROUPS, SCHOOL_EXPENSE_ITEMS } from '@erp/shared/procurement-catalog';
import { formatMoney } from '../lib/format';
import { Button, Field, Input, Select } from './ui';

export type PurchaseDraftLine={description:string;quantity:string;price:string;expenseHeadCode?:string;gstPercent?:string;hsnSac?:string};
export function lineDescription(line:PurchaseDraftLine){const item=SCHOOL_EXPENSE_ITEMS.find((entry)=>entry.code===line.expenseHeadCode);return item?`${item.name}${line.description.trim()?` — ${line.description.trim()}`:''}`:line.description.trim();}
const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

export function SchoolPurchaseLines({items,onChange,priceLabel='Unit price (before GST)',includeGST=false}:{items:PurchaseDraftLine[];onChange:(items:PurchaseDraftLine[])=>void;priceLabel?:string;includeGST?:boolean}){
  const update=(index:number,patch:Partial<PurchaseDraftLine>)=>onChange(items.map((item,i)=>i===index?{...item,...patch}:item));
  const totals=items.reduce((sum,item)=>{const taxable=round((Number(item.quantity)||0)*(Number(item.price)||0));const gst=includeGST?round((Number(item.quantity)||0)*(Number(item.price)||0)*(Number(item.gstPercent)||0)/100):0;return {taxable:round(sum.taxable+taxable),gst:round(sum.gst+gst)};},{taxable:0,gst:0});
  return <div className="space-y-4">{items.map((item,index)=><div key={index} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex items-center justify-between"><h3 className="text-xs font-bold text-slate-600">Item {index+1}</h3><Button type="button" variant="ghost" size="sm" onClick={()=>onChange(items.filter((_,i)=>i!==index))} disabled={items.length===1}>Remove</Button></div>
    <Field label="School item / service" htmlFor={`purchase-item-${index}`} required><Select id={`purchase-item-${index}`} value={item.expenseHeadCode??''} onChange={(event)=>update(index,{expenseHeadCode:event.target.value,description:''})} required><option value="">Select item or service</option>{SCHOOL_EXPENSE_GROUPS.map((group)=><optgroup key={group.code} label={group.name}>{group.items.map(([code,name])=><option key={code} value={code}>{name}</option>)}</optgroup>)}<optgroup label="Other / existing quotation"><option value="custom">Other approved item / item from request</option></optgroup></Select></Field>
    <Field label={item.expenseHeadCode&&item.expenseHeadCode!=='custom'?'Specification / description (optional)':'Item description'} htmlFor={`purchase-description-${index}`}><Input id={`purchase-description-${index}`} value={item.description} onChange={(event)=>update(index,{description:event.target.value})} placeholder="Brand, model, size or service period" maxLength={180} required={!item.expenseHeadCode||item.expenseHeadCode==='custom'}/></Field>
    <div className={`grid gap-3 ${includeGST?'sm:grid-cols-2 lg:grid-cols-4':'sm:grid-cols-2'}`}>
      <Field label="Quantity" htmlFor={`purchase-qty-${index}`} required><Input id={`purchase-qty-${index}`} type="number" min={0.01} max={1000000} step="0.01" value={item.quantity} onChange={(event)=>update(index,{quantity:event.target.value})} required/></Field>
      <Field label={priceLabel} htmlFor={`purchase-price-${index}`} required><Input id={`purchase-price-${index}`} type="number" min={0} step="0.01" value={item.price} onChange={(event)=>update(index,{price:event.target.value})} required/></Field>
      {includeGST&&<><Field label="GST % (quotation rate)" htmlFor={`purchase-gst-${index}`}><Input id={`purchase-gst-${index}`} type="number" min={0} max={100} step="0.01" value={item.gstPercent??'0'} onChange={(event)=>update(index,{gstPercent:event.target.value})} required list="quotation-gst-rates"/></Field><Field label="HSN / SAC (optional)" htmlFor={`purchase-hsn-${index}`}><Input id={`purchase-hsn-${index}`} value={item.hsnSac??''} onChange={(event)=>update(index,{hsnSac:event.target.value})} inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8}/></Field></>}
    </div>
    <p className="text-right text-xs font-bold text-slate-600">{includeGST?'Line total including GST':'Estimated line total'}: {formatMoney(round((Number(item.quantity)||0)*(Number(item.price)||0))+ (includeGST?round((Number(item.quantity)||0)*(Number(item.price)||0)*(Number(item.gstPercent)||0)/100):0))}</p>
  </div>)}
    <datalist id="quotation-gst-rates"><option value="0"/><option value="5"/><option value="18"/></datalist>
    <div className="flex flex-wrap justify-between gap-3"><Button type="button" variant="secondary" size="sm" onClick={()=>onChange([...items,{description:'',quantity:'1',price:'',expenseHeadCode:'',gstPercent:'0'}])}>Add item</Button><div className="space-y-1 text-right text-sm"><p>Subtotal: <strong>{formatMoney(totals.taxable)}</strong></p>{includeGST&&<p>GST: <strong>{formatMoney(totals.gst)}</strong></p>}<p className="font-extrabold">{includeGST?'Grand total':'Estimated total'}: {formatMoney(round(totals.taxable+totals.gst))}</p></div></div>
    {includeGST&&<p className="text-xs text-slate-500">Unit prices exclude GST. Enter the applicable rate from the vendor quotation; 0 means no GST added. Totals are calculated and saved by the server. This purchase order is not a tax invoice.</p>}
  </div>;
}
