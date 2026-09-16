import { Router } from 'express';
import { getPlayer } from '../scrapers/playersScaper';

const router = Router();

router.get('/:id', async (req, res) => {
  const { id } = req.params;

  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    res.status(400).json({ message: 'Invalid GT number' });
    return;
  }

  try {
    const data = await getPlayer(id);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'An error occured' });
  }
});

export default router;
