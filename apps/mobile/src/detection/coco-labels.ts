/**
 * Standard 90-slot COCO label map used by TFLite SSD PostProcess models
 * (class output is a 0-based index into this list; null = unused COCO id).
 */
export const COCO_LABELS: ReadonlyArray<string | null> = [
  'person', // 0
  'bicycle',
  'car',
  'motorcycle',
  'airplane',
  'bus',
  'train',
  'truck',
  'boat',
  'traffic light', // 9
  'fire hydrant',
  null,
  'stop sign',
  'parking meter',
  'bench',
  'bird',
  'cat',
  'dog',
  'horse',
  'sheep', // 19
  'cow',
  'elephant',
  'bear',
  'zebra',
  'giraffe',
  null,
  'backpack',
  'umbrella',
  null,
  null, // 29
  'handbag',
  'tie',
  'suitcase',
  'frisbee',
  'skis',
  'snowboard',
  'sports ball',
  'kite',
  'baseball bat',
  'baseball glove', // 39
  'skateboard',
  'surfboard',
  'tennis racket',
  'bottle',
  null,
  'wine glass',
  'cup',
  'fork',
  'knife',
  'spoon', // 49
  'bowl',
  'banana',
  'apple',
  'sandwich',
  'orange',
  'broccoli',
  'carrot',
  'hot dog',
  'pizza',
  'donut', // 59
  'cake',
  'chair',
  'couch',
  'potted plant',
  'bed',
  null,
  'dining table',
  null,
  null,
  'toilet', // 69
  null,
  'tv',
  'laptop',
  'mouse',
  'remote',
  'keyboard',
  'cell phone',
  'microwave',
  'oven',
  'toaster', // 79
  'sink',
  'refrigerator',
  null,
  'book',
  'clock',
  'vase',
  'scissors',
  'teddy bear',
  'hair drier',
  'toothbrush', // 89
];

/**
 * Classes that must NOT dominate a pothole sample (content guidelines:
 * people, vehicles, animals, plants, signs). A large detection of any of
 * these triggers the "keep the road in frame" hint.
 */
export const AVOID_CLASSES: ReadonlySet<string> = new Set([
  'person',
  'bicycle',
  'car',
  'motorcycle',
  'bus',
  'truck',
  'bird',
  'cat',
  'dog',
  'horse',
  'sheep',
  'cow',
  'elephant',
  'bear',
  'zebra',
  'giraffe',
  'potted plant',
  'stop sign',
  'parking meter',
  'bench',
]);
