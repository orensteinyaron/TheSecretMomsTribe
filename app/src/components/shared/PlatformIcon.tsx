import { Camera, Music2 } from 'lucide-react';

export function PlatformIcon({ platform, size = 16 }: { platform: string; size?: number }) {
  if (platform === 'instagram') return <Camera size={size} className="text-pink-400" />;
  if (platform === 'tiktok') return <Music2 size={size} className="text-cyan-400" />;
  return null;
}
