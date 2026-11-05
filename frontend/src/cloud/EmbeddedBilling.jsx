import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../lib/AuthContext';
import ErrorBoundary from '../components/ErrorBoundary';
import Billing from '../pages/Billing';
import styles from '../styles.css?inline';
import { createBillingHost } from './billingHost';

function MembershipSync({onChange}) {
  const {tier,tierStatus}=useAuth();
  useEffect(()=>{if(tierStatus==='ready')onChange?.();},[tier,tierStatus,onChange]);
  return null;
}
function BillingPanel(){
  const {loading}=useAuth();
  return loading?<div className="page-loading" role="status">Loading…</div>:<Billing embedded />;
}
export function mountBilling(host,onMembershipChange) {
  const {mount}=createBillingHost(host,styles+`
    :host{display:block;font:inherit;color:var(--txt)}
    .billing-surface{min-height:0}
    .billing-page{min-height:calc(100dvh - 64px);max-width:1200px;padding:0 36px 24px}
    @media(max-width:900px){.billing-page .plan-grid{grid-template-columns:1fr}.billing-page .plan-card{min-height:0}.billing-page .featured .pc-feats{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:620px){.billing-page{padding:0 20px 24px}.billing-page .featured .pc-feats{grid-template-columns:1fr}}
  `);
  createRoot(mount).render(<AuthProvider><ErrorBoundary><MembershipSync onChange={onMembershipChange}/><BillingPanel /></ErrorBoundary></AuthProvider>);
}
