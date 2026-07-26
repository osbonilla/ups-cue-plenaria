import styles from './Slides.module.css';
import state from '../../stores/state';
import { FC, ReactNode, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import navigationState from '../../stores/navigation';
import Slide from '@arcgis/core/webscene/Slide';

interface Props {
  children?: ReactNode;
}

const normalizeHeading = (heading: number) => {
  const normalized = heading % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const sceneHeadingToMapRotation = (heading: number) => normalizeHeading(-heading);

interface SlideNavigationSnapshot {
  viewpoint: __esri.Viewpoint;
  center: __esri.Point;
  heading: number;
  scale: number | null;
}

export const Bookmarks: FC<Props> = observer(() => {
  const sceneView = state.getView("scene");
  const mapView = state.getView("map");
  const sceneLoaded = state.viewLoadedById.scene;
  const [slides, setSlides] = useState<__esri.Collection<__esri.Slide>>();
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const [, setSlidesVersion] = useState(0);

  useEffect(() => {
    if (sceneLoaded && sceneView) {
      const view = sceneView;
      const slides = view.map.presentation.slides;
      setSlides(slides);
    }
  }, [sceneLoaded, sceneView]);

  const getSlideNavigationSnapshot = (slide: __esri.Slide): SlideNavigationSnapshot | null => {
    const viewpoint = slide?.viewpoint;
    if (!viewpoint) {
      return null;
    }

    const targetGeometry = viewpoint.targetGeometry;
    const centerFromTarget = targetGeometry?.type === 'point' ? (targetGeometry as __esri.Point) : null;
    const centerFromCamera = viewpoint.camera?.position ?? null;
    const center = centerFromTarget ?? centerFromCamera;

    if (!center) {
      return null;
    }

    const cameraHeading = viewpoint.camera?.heading;
    const heading = Number.isFinite(cameraHeading) ? normalizeHeading(cameraHeading as number) : 0;
    const scaleCandidate = (viewpoint as any).scale;
    const scale = Number.isFinite(scaleCandidate) ? Number(scaleCandidate) : null;

    return {
      viewpoint,
      center,
      heading,
      scale,
    };
  };

  const applySlideNavigation = async (slide: __esri.Slide) => {
    const snapshot = getSlideNavigationSnapshot(slide);
    if (!snapshot) {
      return;
    }

    const activeViewId = state.activeViewId;
    let appliedToScene = false;

    try {
      // Apply complete slide state (camera + environment such as lighting/weather)
      // as authored in the WebScene slide JSON.
      if (sceneView && typeof (slide as any).applyTo === 'function') {
        await (slide as any).applyTo(sceneView, {
          duration: 650,
          easing: 'ease-in-out',
        });
        appliedToScene = true;
      }

      if (activeViewId === 'map' && mapView) {
        const mapTarget: any = {
          center: snapshot.center.clone?.() ?? snapshot.center,
          rotation: sceneHeadingToMapRotation(snapshot.heading),
        };

        if (snapshot.scale !== null) {
          mapTarget.scale = snapshot.scale;
        }

        await mapView.goTo(mapTarget, {
          duration: 650,
          easing: 'ease-in-out',
        });

        return;
      }

      if (sceneView) {
        if (appliedToScene) {
          return;
        }

        await sceneView.goTo(snapshot.viewpoint, {
          duration: 650,
          easing: 'ease-in-out',
        });
      }
    } catch {
      // Ignore goTo interruptions when users click bookmarks quickly.
    }
  };

  const handleCreateSlide = async () => {
    if (!sceneView) return;

    const view = sceneView;
    const webScene = view.map as __esri.WebScene;
    const nextSlideNumber = (webScene.presentation?.slides?.length ?? 0) + 1;

    try {
      const newSlide = await Slide.createFrom(view);
      newSlide.title.text = `Bookmark ${nextSlideNumber}`;

      webScene.presentation.slides.add(newSlide);
      setSlides(webScene.presentation.slides);
      setActiveSlideId(newSlide.id ?? null);
      setSlidesVersion((version) => version + 1);
      // not needed for a public version, user will only create/delete bookmarks for the current session
      // await webScene.save();
    } catch (error) {
      console.error('Unable to create/save slide.', error);
    }
  };

  const handleDeleteSlide = async (slide: __esri.Slide) => {
    if (!sceneView) return;

    const webScene = sceneView.map as __esri.WebScene;

    try {
      webScene.presentation.slides.remove(slide);
      setSlides(webScene.presentation.slides);
      setActiveSlideId((current) => (current === slide.id ? null : current));
      setSlidesVersion((version) => version + 1);
      // not needed for a public version, user will only create/delete bookmarks for the current session
      // await webScene.save();
    } catch (error) {
      console.error('Unable to delete/save slide.', error);
    }
  };

  return (
    <>
    {navigationState.toggles.bookmarks && 
      <div className={styles.slidesContainer}>
        {slides &&
          slides.length > 0 &&
          slides.map((slide) => (
            <div
              key={slide.id}
              id={slide.id}
              className={styles.slide}
              onClick={() => {
                  setActiveSlideId(slide.id ?? null);
                  void applySlideNavigation(slide);
              }}
            >
              <img
                src={slide.thumbnail.url}
                title={slide.title.text}
                  className={`${styles.circleImage} ${activeSlideId === slide.id ? styles.active : ''}`}
              ></img>
              <button
                type='button'
                className={styles.deleteButton}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleDeleteSlide(slide);
                }}
                title='Delete bookmark'
                aria-label='Delete bookmark'
              >
                ×
              </button>
            </div>
          ))}
        <button
          type='button'
          className={styles.addSlideButton}
          onClick={handleCreateSlide}
          title='Create bookmark from current view'
          aria-label='Create bookmark from current view'
        >
          +
        </button>
      </div>
      }
    </>
  );
});