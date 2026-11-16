import { useEffect, useState, type InputHTMLAttributes } from 'react';

type DecimalInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValueChange: (value: number) => void;
};

export function parseDecimalText(text: string): number {
  const value = Number(text);
  return text.trim() === '' || !Number.isFinite(value) ? 0 : value;
}

/** "05" → "5" while typing; keeps "0.5" and a lone "0". */
export function stripLeadingZeros(text: string): string {
  return text.replace(/^(-?)0+(?=\d)/, '$1');
}

/** Numeric field that can be cleared while editing instead of snapping back to a stuck leading 0. */
export function DecimalInput({ value, onValueChange, inputMode = 'decimal', step = 'any', ...rest }: DecimalInputProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((current) => (parseDecimalText(current) === value ? current : String(value)));
  }, [value]);
  return (
    <input
      {...rest}
      type="number"
      inputMode={inputMode}
      step={step}
      value={text}
      onChange={(event) => {
        const next = stripLeadingZeros(event.target.value);
        setText(next);
        onValueChange(parseDecimalText(next));
      }}
    />
  );
}
