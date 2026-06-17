'use client';

import {
  ReactCompareSlider,
  ReactCompareSliderImage,
} from 'react-compare-slider';

interface ImageCompareSliderProps {
  originalUrl: string;
  resultUrl: string;
}

export function ImageCompareSlider({
  originalUrl,
  resultUrl,
}: ImageCompareSliderProps) {
  return (
    <ReactCompareSlider
      itemOne={<ReactCompareSliderImage src={originalUrl} alt="Original" />}
      itemTwo={<ReactCompareSliderImage src={resultUrl} alt="Result" />}
      className="aspect-video max-h-[480px]"
    />
  );
}
