exports.handlePlaidWebhook = async (req, res) => {
  try {
    const payload = req.body;
    
    console.log("======================================================");
    console.log("🔔 INCOMING PLAID WEBHOOK");
    console.log("Webhook Type:", payload.webhook_type);
    console.log("Webhook Code:", payload.webhook_code);
    console.log("Item ID:", payload.item_id);
    console.log("Full Payload:");
    console.dir(payload, { depth: null, colors: true });
    console.log("======================================================");

    // Plaid webhooks expect a 200 OK response immediately
    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Error handling webhook:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
