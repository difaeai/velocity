import { useEffect, useState } from 'react';

import { studioApi } from './api';

/** Whether the signed-in customer's own 3 days are over, so a page asks for what the server will charge. */
export function useStudioPriceRaised(): boolean {
  const [raised, setRaised] = useState(false);
  useEffect(() => {
    studioApi
      .priceClock({})
      .then((clock) => setRaised(clock.raised))
      .catch(() => undefined);
  }, []);
  return raised;
}
