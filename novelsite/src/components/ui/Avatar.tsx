import React from 'react';
import Image from 'next/image';
import styles from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  src?: string;
  alt?: string;
  name?: string;
  size?: AvatarSize;
  className?: string;
  onClick?: () => void;
}

const SIZE_PX: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.charAt(0).toUpperCase();
}

export function Avatar({ src, alt, name = '', size = 'md', className = '', onClick }: AvatarProps) {
  const px = SIZE_PX[size];
  const classes = [
    styles.avatar,
    styles[`avatar--${size}`],
    onClick ? styles['avatar--clickable'] : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      aria-label={alt ?? name}
    >
      {src ? (
        <Image
          src={src}
          alt={alt ?? name}
          width={px}
          height={px}
          style={{ objectFit: 'cover', borderRadius: '50%' }}
        />
      ) : (
        <span className={styles.avatar__initials} aria-hidden="true">
          {getInitials(name)}
        </span>
      )}
    </div>
  );
}
