'use client';

import { useEffect, useState } from 'react';
import { UpgradeModal } from './UpgradeModal';

interface UpgradeModalWrapperProps {
  shouldShow: boolean;
  hiddenMatchCount: number;
  email: string;
}

export function UpgradeModalWrapper({ shouldShow, hiddenMatchCount, email }: UpgradeModalWrapperProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (shouldShow && hiddenMatchCount > 0) {
      // Small delay to ensure page is loaded
      const timer = setTimeout(() => {
        setOpen(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [shouldShow, hiddenMatchCount]);

  if (!shouldShow || hiddenMatchCount === 0) {
    return null;
  }

  return (
    <UpgradeModal
      open={open}
      onOpenChange={setOpen}
      hiddenMatchCount={hiddenMatchCount}
      email={email}
    />
  );
}

