#!/usr/bin/env bash
#
# prepare_ssdlite.sh — build the 'ssd-coco' avoid-object model for the app.
#
# Downloads the ssdlite_mobilenet_v2_coco frozen graph from the TensorFlow
# object-detection model zoo (the same source URL the OpenVINO model.yml
# references) and converts it to TFLite with the standard SSD export recipe:
# uint8 input normalized_input_image_tensor [1,300,300,3] and the custom
# TFLite_Detection_PostProcess op as output.
#
# NOTES
#  - License: the model is released under Apache-2.0 (TensorFlow models repo).
#  - This model detects generic COCO objects — the app uses it to flag
#    AVOID-objects in the frame (people, vehicles, animals, …). It does NOT
#    detect potholes; the 'road-binary' model handles road/non-road.
#  - Requires: curl, tar, and a Python env with TF 1.x-style `tflite_convert`
#    on PATH (e.g. pip install tensorflow==1.15 or use the TF1 docker image).
#
# Upload the result via the admin Services panel (POST /api/v1/admin/models,
# multipart file=ssdlite_mobilenet_v2_coco.tflite, kind=ssd-coco).

set -euo pipefail

URL="http://download.tensorflow.org/models/object_detection/ssdlite_mobilenet_v2_coco_2018_05_09.tar.gz"
WORK="${1:-./ssdlite-work}"
OUT="ssdlite_mobilenet_v2_coco.tflite"

mkdir -p "$WORK"
cd "$WORK"

if [ ! -f ssdlite_mobilenet_v2_coco_2018_05_09/tflite_graph.pb ] && [ ! -f ssdlite_mobilenet_v2_coco_2018_05_09/frozen_inference_graph.pb ]; then
  echo ">> downloading $URL"
  curl -fL "$URL" -o ssdlite.tar.gz
  tar -xzf ssdlite.tar.gz
fi

GRAPH="ssdlite_mobilenet_v2_coco_2018_05_09/frozen_inference_graph.pb"
# If you re-exported with export_tflite_ssd_graph.py, prefer tflite_graph.pb.
[ -f ssdlite_mobilenet_v2_coco_2018_05_09/tflite_graph.pb ] && GRAPH="ssdlite_mobilenet_v2_coco_2018_05_09/tflite_graph.pb"

echo ">> converting $GRAPH -> $OUT"
tflite_convert \
  --graph_def_file="$GRAPH" \
  --output_file="$OUT" \
  --input_arrays=normalized_input_image_tensor \
  --input_shapes=1,300,300,3 \
  --inference_type=QUANTIZED_UINT8 \
  --mean_values=128 \
  --std_dev_values=128 \
  --output_arrays='TFLite_Detection_PostProcess,TFLite_Detection_PostProcess:1,TFLite_Detection_PostProcess:2,TFLite_Detection_PostProcess:3' \
  --allow_custom_ops

echo ">> done: $WORK/$OUT"
echo ">> upload via admin Services (kind: ssd-coco). Apache-2.0 licensed."
echo ">> reminder: detects avoid-objects (people/vehicles/animals), NOT potholes."
