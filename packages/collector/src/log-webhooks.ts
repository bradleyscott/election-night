import { createServer } from 'http';

const PORT = parseInt(process.env.WEBHOOK_LOG_PORT || '3458', 10);

const server = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const timestamp = new Date().toISOString();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  Webhook received at ${timestamp}`);
    console.log(`  ${req.method} ${req.url}`);
    console.log(`${'-'.repeat(60)}`);

    try {
      const parsed = JSON.parse(body);
      console.log(`  Event type: ${parsed.event || 'unknown'}`);
      console.log(`  Electorate: ${parsed.electorateName || 'unknown'}`);
      console.log(`${'-'.repeat(60)}`);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log('  (Raw body - not valid JSON)');
      console.log(body);
    }

    console.log(`${'='.repeat(60)}\n`);
    res.writeHead(200).end('OK');
  });
});

server.listen(PORT, () => {
  console.log(`Webhook logger listening on http://localhost:${PORT}`);
  console.log(`Set WEBHOOK_URL=http://localhost:${PORT} to capture webhooks.`);
});
