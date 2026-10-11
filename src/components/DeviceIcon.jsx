import { Monitor, Smartphone, Tablet } from 'lucide-react';

const ICONS = { phone: Smartphone, tablet: Tablet, desktop: Monitor };

export default function DeviceIcon({ kind, ...props }) {
  const Icon = ICONS[kind] ?? Monitor;
  return <Icon {...props} />;
}
