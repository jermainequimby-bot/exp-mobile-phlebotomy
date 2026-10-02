const SERVICES={
  local:{name:'EXP Local',price:60},
  standard:{name:'Standard EXP',price:70},
  fast:{name:'Fast Track / Same-Day EXP',price:95},
  after:{name:'After-Hours EXP',price:90}
};

function expectedFee(miles){
  if(miles<=10)return 0;
  if(miles<=15)return 10;
  if(miles<=20)return 20;
  if(miles<=25)return 30;
  return null;
}

function add(form,key,value){form.append(key,String(value));}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    if(!process.env.STRIPE_SECRET_KEY)return res.status(500).json({error:'Stripe is not configured yet.'});

    const{service,address,quote}=req.body||{};
    if(!['auto','fast','after'].includes(service)||!address||!quote){
      return res.status(400).json({error:'Missing booking information.'});
    }

    const miles=Number(quote.miles);
    const fee=expectedFee(miles);
    if(!Number.isFinite(miles)||fee===null||Number(quote.travelFee)!==fee){
      return res.status(400).json({error:'Travel quote is invalid or expired. Please calculate the total again.'});
    }

    const effectiveService=service==='auto'
      ? (miles<=10?'local':'standard')
      : service;
    const s=SERVICES[effectiveService];
    if(!s)return res.status(400).json({error:'Invalid service.'});

    const total=s.price+fee;
    if(quote.service!==effectiveService||Number(quote.total)!==total){
      return res.status(400).json({error:'Price mismatch. Please calculate the total again.'});
    }

    const form=new URLSearchParams();
    add(form,'mode','payment');
    add(form,'line_items[0][quantity]','1');
    add(form,'line_items[0][price_data][currency]','usd');
    add(form,'line_items[0][price_data][unit_amount]',Math.round(total*100));
    add(form,'line_items[0][price_data][product_data][name]',s.name);
    add(form,'line_items[0][price_data][product_data][description]',
      fee?'Includes $'+fee+' travel fee.':'Includes local travel.');
    const origin=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_URL?'https://'+process.env.VERCEL_URL:(process.env.PUBLIC_SITE_URL||'https://expmobilephlebotomy.com');
    add(form,'success_url',origin+'/booking-success.html?session_id={CHECKOUT_SESSION_ID}');
    add(form,'cancel_url',origin+'/booking.html');
    add(form,'metadata[service]',effectiveService);
    add(form,'metadata[address]',address);
    add(form,'metadata[miles]',miles.toFixed(1));
    add(form,'metadata[travel_fee]',fee);
    add(form,'metadata[base_price]',s.price);

    const response=await fetch('https://api.stripe.com/v1/checkout/sessions',{
      method:'POST',
      headers:{
        'Authorization':'Bearer '+process.env.STRIPE_SECRET_KEY,
        'Content-Type':'application/x-www-form-urlencoded'
      },
      body:form
    });

    const data=await response.json();
    if(!response.ok||!data.url){
      console.error('Stripe API error',response.status,JSON.stringify(data));
      return res.status(400).json({
        error:process.env.VERCEL_ENV==='preview'&&data?.error?.message
          ?'Stripe error: '+data.error.message
          :'Unable to start secure checkout.'
      });
    }

    return res.status(200).json({url:data.url});
  }catch(e){
    console.error('Stripe checkout error',e);
    return res.status(500).json({error:'Unable to start secure checkout.'});
  }
}