import crypto from 'node:crypto';

export const config={api:{bodyParser:false}};

async function rawBody(req){
  const chunks=[];
  for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function verifySignature(payload,header,secret){
  if(!header||!secret)throw new Error('Missing Stripe webhook signature or secret.');
  const parts=header.split(',').reduce((acc,item)=>{
    const [k,v]=item.split('=');
    if(k&&v)(acc[k]??=[]).push(v);
    return acc;
  },{});
  const timestamp=parts.t?.[0];
  const signatures=parts.v1||[];
  if(!timestamp||!signatures.length)throw new Error('Invalid Stripe-Signature header.');
  const age=Math.abs(Date.now()/1000-Number(timestamp));
  if(!Number.isFinite(age)||age>300)throw new Error('Webhook timestamp outside tolerance.');
  const signedPayload=timestamp+'.'+payload.toString('utf8');
  const expected=crypto.createHmac('sha256',secret).update(signedPayload).digest('hex');
  const matches=signatures.some(sig=>sig.length===expected.length&&crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)));
  if(!matches)throw new Error('Webhook signature verification failed.');
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const payload=await rawBody(req);
    verifySignature(payload,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);
    const event=JSON.parse(payload.toString('utf8'));
    switch(event.type){
      case 'checkout.session.completed':{
        const session=event.data.object;
        console.log('EXP payment confirmed',JSON.stringify({
          eventId:event.id,
          sessionId:session.id,
          paymentStatus:session.payment_status,
          amountTotal:session.amount_total,
          service:session.metadata?.service,
          address:session.metadata?.address,
          miles:session.metadata?.miles,
          travelFee:session.metadata?.travel_fee
        }));
        break;
      }
      default:
        console.log('Unhandled Stripe event',event.type);
    }
    return res.status(200).json({received:true});
  }catch(e){
    console.error('Stripe webhook error',e);
    return res.status(400).json({error:'Webhook verification failed.'});
  }
}