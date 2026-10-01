# EXP Booking Engine

This branch contains the dynamic pricing and Stripe Checkout layer for EXP: Mobile Phlebotomy.

## Pricing
0-10 miles: $0 travel
10.1-15 miles: $10
15.1-20 miles: $20
20.1-25 miles: $30
25+ miles: custom quote

Reference point: Florida Medical Lab, 631 W 23rd St, Panama City, FL 32405.

## Required server environment variables
- STRIPE_SECRET_KEY
- GOOGLE_ROUTES_API_KEY
- PUBLIC_SITE_URL

Never put secret keys in public HTML or client-side JavaScript.

## Hosting
GitHub Pages can serve the static files but cannot execute the server-side API functions in /api. Deploy this branch to a serverless Node host before making it public.

## Calendar
Existing Google Calendar schedules are intentionally untouched. Calendar automation will be added after the dynamic payment flow is tested and exact weekend hours are confirmed.