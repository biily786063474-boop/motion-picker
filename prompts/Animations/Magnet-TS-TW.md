## Integrate the <Magnet /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: Magnet
### Variant: TypeScript + Tailwind


---

### Usage Example
```jsx
import Magnet from './Magnet'

<Magnet padding={50} disabled={false} magnetStrength={50}>
  <p>Star React Bits on GitHub!</p>
</Magnet>
```

### Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| padding | number | 100 | Specifies the distance (in pixels) around the element that activates the magnet pull. |
| disabled | boolean | — | Disables the magnet effect when set to true. |
| magnetStrength | number | 2 | Controls the strength of the pull; higher values reduce movement, lower values increase it. |
| activeTransition | string | "transform 0.3s ease-out" | CSS transition applied to the element when the magnet is active. |
| inactiveTransition | string | "transform 0.5s ease-in-out" | CSS transition applied when the magnet is inactive (mouse out of range). |
| wrapperClassName | string | "" | Optional CSS class name for the outermost wrapper element. |
| innerClassName | string | "" | Optional CSS class name for the moving (inner) element. |
| children | ReactNode | — | The content (JSX) to be displayed inside the magnetized element. |

### Full Component Source
```tsx
import React, { useState, useEffect, useRef, ReactNode, HTMLAttributes } from 'react';

interface MagnetProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: number;
  disabled?: boolean;
  magnetStrength?: number;
  activeTransition?: string;
  inactiveTransition?: string;
  wrapperClassName?: string;
  innerClassName?: string;
}

const Magnet: React.FC<MagnetProps> = ({
  children,
  padding = 100,
  disabled = false,
  magnetStrength = 2,
  activeTransition = 'transform 0.3s ease-out',
  inactiveTransition = 'transform 0.5s ease-in-out',
  wrapperClassName = '',
  innerClassName = '',
  ...props
}) => {
  const [isActive, setIsActive] = useState<boolean>(false);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const magnetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) {
      setPosition({ x: 0, y: 0 });
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!magnetRef.current) return;

      const { left, top, width, height } = magnetRef.current.getBoundingClientRect();
      const centerX = left + width / 2;
      const centerY = top + height / 2;

      const distX = Math.abs(centerX - e.clientX);
      const distY = Math.abs(centerY - e.clientY);

      if (distX < width / 2 + padding && distY < height / 2 + padding) {
        setIsActive(true);
        const offsetX = (e.clientX - centerX) / magnetStrength;
        const offsetY = (e.clientY - centerY) / magnetStrength;
        setPosition({ x: offsetX, y: offsetY });
      } else {
        setIsActive(false);
        setPosition({ x: 0, y: 0 });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [padding, disabled, magnetStrength]);

  const transitionStyle = isActive ? activeTransition : inactiveTransition;

  return (
    <div
      ref={magnetRef}
      className={wrapperClassName}
      style={{ position: 'relative', display: 'inline-block' }}
      {...props}
    >
      <div
        className={innerClassName}
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
          transition: transitionStyle,
          willChange: 'transform'
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default Magnet;

```

### Integration Instructions
1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.
