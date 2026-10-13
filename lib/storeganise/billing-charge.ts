/** This checkout requires the customer's card and 3DS interaction on every payment. */
export async function handleBillingCharge() {
  return { error:'CUSTOMER_ACTION_REQUIRED',message:'Open the invoice checkout for the customer to enter their card and approve payment.' };
}

