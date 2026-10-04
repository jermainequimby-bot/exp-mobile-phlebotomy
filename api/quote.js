const ORIGIN_PLACE_ID='ChIJLwzw2-WDk4gRMJXSXR_sGSU';

function travelFee(miles){
  if(miles<=10)return 0;
  if(miles<=15)return 10;
  if(miles<=20)return 20;
  if(miles<=25)return 30;
  return null;
}

const SERVICES={
  auto:{name:'EXP Local / Standard EXP',price:0},
  local:{name:'EXP Local',price:60},
  standard:{name:'Standard EXP',price:70},
  fast:{name:'Fast Track / Same-Day EXP',price:95},
  after:{name:'After-Hours EXP',price:90}
};

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const{service,address}=req.body||{};
    if(!['auto','fast','after'].includes(service))return res.status(400).json({error:'Invalid service.'});
    if(!address||address.length<8)return res.status(400).json({error:'Please provide a complete service address.'});
    if(!process.env.GOOGLE_ROUTES_API_KEY)return res.status(500).json({error:'Routes service is not configured yet.'});

    const response=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'X-Goog-Api-Key':process.env.GOOGLE_ROUTES_API_KEY,
        'X-Goog-FieldMask':'routes.distanceMeters,routes.duration'
      },
      body:JSON.stringify({
        origin:{placeId:ORIGIN_PLACE_ID},
        destination:{address},
        travelMode:'DRIVE',
        routingPreference:'TRAFFIC_UNAWARE',
        languageCode:'en-US',
        regionCode:'US',
        units:'IMPERIAL'
      })
    });

    const data=await response.json();
    if(!response.ok||!data.routes?.length){
      console.error('Google Routes API error',response.status,JSON.stringify(data));
      const detail=data?.error?.message;
      return res.status(400).json({
        error:process.env.VERCEL_ENV==='preview'&&detail
          ?'Google Routes error: '+detail
          :'We could not calculate a driving route for that address. Please check the address and try again.'
      });
    }

    const miles=data.routes[0].distanceMeters/1609.344;
    const roundedMiles=Math.round(miles*10)/10;
    const fee=travelFee(miles);

    if(fee===null){
      return res.status(200).json({
        requestedService:service,
        service:null,
        miles:roundedMiles,
        travelFee:null,
        total:null,
        custom:true
      });
    }

    const effectiveService=service==='auto'
      ? (miles<=10?'local':'standard')
      : service;
    const base=SERVICES[effectiveService].price;

    return res.status(200).json({
      requestedService:service,
      service:effectiveService,
      name:SERVICES[effectiveService].name,
      price:base,
      miles:roundedMiles,
      travelFee:fee,
      total:base+fee,
      custom:false
    });
  }catch(e){
    console.error('Quote handler error',e);
    return res.status(500).json({error:'Unable to calculate travel distance right now.'});
  }
}