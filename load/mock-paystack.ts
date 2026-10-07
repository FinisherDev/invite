import express from 'express';

const app = express();
app.use(express.json());
app.post('/transaction/initialize', (req, res) => {
  res.json({ status: true, data: { authorization_url: `https://mock.pay/${req.body.reference}`, reference: req.body.reference } });
});
app.get('/transaction/verify/:ref', (_req, res) => {
  res.json({ status: true, data: { status: 'abandoned', amount: 0 } });
});
app.post('/refund', (_req, res) => {
  res.json({ status: true, data: { id: Date.now(), status: 'pending' } });
});
app.listen(4010, () => console.log('mock paystack on :4010'));