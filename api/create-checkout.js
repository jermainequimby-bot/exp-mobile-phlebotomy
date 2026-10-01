import Stripe from 'stripe';

const SERVICES = {
  local: {name:'EXP Local', price:60},
  standard: {name:'Standard EXP', price:70},
  fast: {name:'Fast Track / Same-Day EXP', price:95},
  after: {name:'After-Hours EXP', price:90}
};

function expectedFee(miles){
  if(miles <= 10) return 0;
  if(miles <= 15) return 10;
  if(miles <= 20) return 20;
  if(miles <= 25) return 30;
  return null;
}

export default async function handler(req,res){
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  try{
    if(!process.env.STRIPE_SECRET_KEY) return res.status(500).json({error:'Stripe is not configured yet.'});
    const {service,address,quote}=req.body||{};
    const s=SERVICES[service];
    if(!s || !address || !quote) return res.status(400).json({error:'Missing booking information.'});
    const miles=Number(quote.miles), fee=expectedFee(miles);
    if(!Number.isFinite(miles) || fee===null || Number(quote.travelFee)!==fee) return res.status(400).json({error:'Travel quote is invalid or expired. Please calculate the total again.'});
    const total=s.price+fee;
    if(Number(quote.total)!==total) return res.status(400).json({error:'Price mismatch. Please calculate the total again.'});

    const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin=process.env.PUBLIC_SITE_URL || 'https://expmobilephlebotomy.com';
    const session=await stripe.checkout.sessions.create({
      mode:'payment',
      line_items:[{
        quantity:1,
        price_data:{
          currency:'usd',
          unit_amount:Math.round(total*100),
          product_data:{name:s.name,description:fee ? 'Includes $'+fee+' travel fee.' : 'Includes local travel.'}
        }
      }],
      success_url:origin+'/booking-success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:origin+'/booking.html',
      metadata:{service,address,miles:miles.toFixed(1),travel_fee:String(fee),base_price:String(s.price)}
    });
    return res.status(200).json({url:session.url});
  }catch(e){return res.status(500).json({error:'Unable to start secure checkout.'});}
}