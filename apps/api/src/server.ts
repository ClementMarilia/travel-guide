import { app } from './app.js';

const port = Number(process.env.PORT ?? 3333);

app.listen(port, () => {
  console.log(`Travel Guide API running on port ${port}`);
});
