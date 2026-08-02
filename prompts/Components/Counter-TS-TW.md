## Integrate the <Counter /> component from React Bits

You are helping integrate an open-source React component into an existing application.

### Component: Counter
### Variant: TypeScript + Tailwind
### Dependencies: motion

---

### Usage Example
```jsx
import Counter from './Counter';

<Counter
  value={1}
  places={[100, 10, 1]}
  fontSize={80}
  padding={5}
  gap={10}
  textColor="white"
  fontWeight={900}
/>
```

### Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| value | number | N/A (required) | The numeric value to display in the counter. |
| fontSize | number | 100 | The base font size used for the counter digits. |
| padding | number | 0 | Additional padding added to the digit height. |
| places | number[] | [100, 10, 1 , "." , 0.1] | Defines which digit positions to display. Include whole number and decimal place values (use "." for the decimal point). If omitted, place values will be detected automatically. |
| gap | number | 8 | The gap (in pixels) between each digit. |
| borderRadius | number | 4 | The border radius (in pixels) for the counter container. |
| horizontalPadding | number | 8 | The horizontal padding (in pixels) for the counter container. |
| textColor | string | 'white' | The text color for the counter digits. |
| fontWeight | string | number | 'bold' | The font weight of the counter digits. |
| containerStyle | React.CSSProperties | {} | Custom inline styles for the outer container. |
| counterStyle | React.CSSProperties | {} | Custom inline styles for the counter element. |
| digitStyle | React.CSSProperties | {} | Custom inline styles for each digit container. |
| gradientHeight | number | 16 | The height (in pixels) of the gradient overlays. |
| gradientFrom | string | 'black' | The starting color for the gradient overlays. |
| gradientTo | string | 'transparent' | The ending color for the gradient overlays. |
| topGradientStyle | React.CSSProperties | undefined | Custom inline styles for the top gradient overlay. |
| bottomGradientStyle | React.CSSProperties | undefined | Custom inline styles for the bottom gradient overlay. |

### Full Component Source
```tsx
import { MotionValue, motion, useSpring, useTransform } from 'motion/react';
import type React from 'react';
import { useEffect } from 'react';

type PlaceValue = number | '.';

interface NumberProps {
  mv: MotionValue<number>;
  number: number;
  height: number;
}

function Number({ mv, number, height }: NumberProps) {
  const y = useTransform(mv, latest => {
    const placeValue = latest % 10;
    const offset = (10 + number - placeValue) % 10;
    let memo = offset * height;
    if (offset > 5) {
      memo -= 10 * height;
    }
    return memo;
  });

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  return <motion.span style={{ ...baseStyle, y }}>{number}</motion.span>;
}

function normalizeNearInteger(num: number): number {
  const nearest = Math.round(num);
  const tolerance = 1e-9 * Math.max(1, Math.abs(num));
  return Math.abs(num - nearest) < tolerance ? nearest : num;
}

function getValueRoundedToPlace(value: number, place: number): number {
  const scaled = value / place;
  return Math.floor(normalizeNearInteger(scaled));
}

interface DigitProps {
  place: PlaceValue;
  value: number;
  height: number;
  digitStyle?: React.CSSProperties;
}

function Digit({ place, value, height, digitStyle }: DigitProps) {
  // Decimal point digit
  if (place === '.') {
    return (
      <span
        className="relative inline-flex items-center justify-center"
        style={{ height, width: 'fit-content', ...digitStyle }}
      >
        .
      </span>
    );
  }

  // Numeric digit
  const valueRoundedToPlace = getValueRoundedToPlace(value, place);
  const animatedValue = useSpring(valueRoundedToPlace);

  useEffect(() => {
    animatedValue.set(valueRoundedToPlace);
  }, [animatedValue, valueRoundedToPlace]);

  const defaultStyle: React.CSSProperties = {
    height,
    position: 'relative',
    width: '1ch',
    fontVariantNumeric: 'tabular-nums'
  };

  return (
    <span className="relative inline-flex overflow-hidden" style={{ ...defaultStyle, ...digitStyle }}>
      {Array.from({ length: 10 }, (_, i) => (
        <Number key={i} mv={animatedValue} number={i} height={height} />
      ))}
    </span>
  );
}

interface CounterProps {
  value: number;
  fontSize?: number;
  padding?: number;
  /**
   * An array of place values that determines which digit positions
   * should be displayed. For decimal places, use "." to represent
   * the decimal point. Leave this prop empty to enable automatic
   * detection based on the current value.
   */
  places?: PlaceValue[];
  gap?: number;
  borderRadius?: number;
  horizontalPadding?: number;
  textColor?: string;
  fontWeight?: React.CSSProperties['fontWeight'];
  containerStyle?: React.CSSProperties;
  counterStyle?: React.CSSProperties;
  digitStyle?: React.CSSProperties;
  gradientHeight?: number;
  gradientFrom?: string;
  gradientTo?: string;
  topGradientStyle?: React.CSSProperties;
  bottomGradientStyle?: React.CSSProperties;
}

export default function Counter({
  value,
  fontSize = 100,
  padding = 0,
  places = [...value.toString()].map((ch, i, a) => {
    if (ch === '.') {
      return '.';
    }

    const dotIndex = a.indexOf('.');
    const isInteger = dotIndex === -1;

    const exponent = isInteger ? a.length - i - 1 : i < dotIndex ? dotIndex - i - 1 : -(i - dotIndex);

    return 10 ** exponent;
  }),
  gap = 8,
  borderRadius = 4,
  horizontalPadding = 8,
  textColor = 'inherit',
  fontWeight = 'inherit',
  containerStyle,
  counterStyle,
  digitStyle,
  gradientHeight = 16,
  gradientFrom = 'black',
  gradientTo = 'transparent',
  topGradientStyle,
  bottomGradientStyle
}: CounterProps) {
  const height = fontSize + padding;

  const defaultContainerStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-block'
  };

  const defaultCounterStyle: React.CSSProperties = {
    fontSize,
    display: 'flex',
    gap,
    overflow: 'hidden',
    borderRadius,
    paddingLeft: horizontalPadding,
    paddingRight: horizontalPadding,
    lineHeight: 1,
    color: textColor,
    fontWeight,
    direction: "ltr"
  };

  const gradientContainerStyle: React.CSSProperties = {
    pointerEvents: 'none',
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between'
  };

  const defaultTopGradientStyle: React.CSSProperties = {
    height: gradientHeight,
    background: `linear-gradient(to bottom, ${gradientFrom}, ${gradientTo})`
  };

  const defaultBottomGradientStyle: React.CSSProperties = {
    height: gradientHeight,
    background: `linear-gradient(to top, ${gradientFrom}, ${gradientTo})`
  };

  return (
    <span style={{ ...defaultContainerStyle, ...containerStyle }}>
      <span style={{ ...defaultCounterStyle, ...counterStyle }}>
        {places.map(place => (
          <Digit key={place} place={place} value={value} height={height} digitStyle={digitStyle} />
        ))}
      </span>
      <span style={gradientContainerStyle}>
        <span style={topGradientStyle ?? defaultTopGradientStyle} />
        <span style={bottomGradientStyle ?? defaultBottomGradientStyle} />
      </span>
    </span>
  );
}

```

### Integration Instructions
1. Install any listed dependencies.
2. Copy the component source into the appropriate directory in the project.
3. Import and render the component using the usage example above as a starting point.
4. Adjust props as needed for the specific use case — refer to the props table for all available options.
