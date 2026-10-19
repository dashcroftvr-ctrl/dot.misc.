GAV — life-size animated character for Quest 3S, with an animation menu
=======================================================================

WHAT'S IN THIS FOLDER
  index.html   the page
  gav.js       the viewer and in-headset menu
  models/      gav.glb (slimmed for the headset: 6 MB, all 20 moves)
  vendor/      the 3D engine (three.js) - nothing loads from the internet

IT MUST BE OPENED FROM AN https:// LINK (same as Gaz & Serg).
  Copy the whole folder to one of your Pi sites with HTTPS, e.g.
      /var/www/<your-site>/gav/
  then open https://<your-site>/gav/ in the Quest browser and press
  "Passthrough - in your room".

IN THE HEADSET
  Animation menu   floats to your left: 20 moves + controls.
                   Press a button with your fingertip, or point a
                   controller (or pinch) and pull the trigger.
                   The current move is highlighted in yellow.
  Thumbstick       flick left / right = previous / next move
  Grip             hide / show the menu
  Point at Gav     + trigger (or pinch) = next move
  Bring here       Gav back in front of you, menu back beside you
  Turn 45°         spin him round to see him from another side
  Spot: on/off     ON  = everything plays on the spot (default)
                   OFF = Walk / Run / Excited Walk / Look Around make
                         him actually walk around your room. He keeps
                         about a metre away from you and turns back
                         before wandering off.
  Speed            1x -> 1.5x -> 0.5x
  Exit             leave passthrough/VR

ON A PC
  Click a move in the list, click Gav or use the arrow keys for the
  next one, drag to look around.

USING ANOTHER CHARACTER
  Any Meshy (Mixamo-rigged) GLB with animations works: put it in
  models/ and change MODEL at the top of gav.js. Button names are
  tidied up automatically from the animation names.
