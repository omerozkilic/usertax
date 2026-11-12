'use client';

import { useState } from 'react';
import styles from './Counter.module.css';

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" className={styles.button} onClick={() => setCount((value) => value + 1)}>
      Clicked {count} times
    </button>
  );
}
