'use client';

import {
  ReactCompareSlider,
  ReactCompareSliderImage,
} from 'react-compare-slider';

interface ImageCompareSliderProps {
  originalUrl: string;
  resultUrl: string;
}

const imageStyle = {
  objectFit: 'contain' as const,
  objectPosition: 'center',
};

export function ImageCompareSlider({
  originalUrl,
  resultUrl,
}: ImageCompareSliderProps) {
  return (
    <ReactCompareSlider
      itemOne={
        <ReactCompareSliderImage
          src={originalUrl}
          alt="Original"
          style={imageStyle}
        />
      }
      itemTwo={
        <ReactCompareSliderImage
          src={resultUrl}
          alt="Result"
          style={imageStyle}
        />
      }
      className="h-full w-full"
    />
  );
}
