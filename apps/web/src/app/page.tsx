import { EarthWebMap } from '../components/EarthWebMap';
import { HeroSplash } from '../components/HeroSplash';
import { AnimatedMount } from '../components/AnimatedMount';

export default function Page() {
  return (
    <AnimatedMount splash={<HeroSplash />}>
      <main style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <EarthWebMap />
      </main>
    </AnimatedMount>
  );
}
