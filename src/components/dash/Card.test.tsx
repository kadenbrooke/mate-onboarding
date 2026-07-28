import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  it('renders label and children', () => {
    render(<Card label="THE PIPELINE"><span>body</span></Card>);
    expect(screen.getByText('THE PIPELINE')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
});
