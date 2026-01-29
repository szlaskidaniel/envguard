const stripe = require('stripe');

const { STRIPE_SECRET_KEY, CUSTOM_KEY } = process.env;

async function createPayment(amount) {
  const stripeClient = stripe(STRIPE_SECRET_KEY);

  return await stripeClient.paymentIntents.create({
    amount,
    currency: 'usd',
  });
}

module.exports = { createPayment };
