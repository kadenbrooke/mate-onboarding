import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, SectionCard } from './Card';

describe('Card', () => {
  it('renders label and children', () => {
    render(<Card label="THE PIPELINE"><span>body</span></Card>);
    expect(screen.getByText('THE PIPELINE')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
});

describe('SectionCard', () => {
  it('renders title and children', () => {
    render(<SectionCard title="Lead flow"><span>inner</span></SectionCard>);
    expect(screen.getByText('Lead flow')).toBeInTheDocument();
    expect(screen.getByText('inner')).toBeInTheDocument();
  });
  it('renders children without a title', () => {
    render(<SectionCard><span>bare</span></SectionCard>);
    expect(screen.getByText('bare')).toBeInTheDocument();
  });
});
