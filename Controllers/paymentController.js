const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.createCheckoutSession = async (req, res) => {
  const { coinName, coinPriceUSD, user_id, coinId } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Buy ${coinName}`,
            },
            unit_amount: Math.round(coinPriceUSD * 100), // in cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.CLIENT_URL}?session_id={CHECKOUT_SESSION_ID}&coin_id=${coinId}&user_id=${user_id}`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
    });

    res.json({ sessionId: session.id });
  } catch (err) {
    console.error("Checkout Error", err);
    res.status(500).json({ error: "Unable to create Stripe session" });
  }
};
