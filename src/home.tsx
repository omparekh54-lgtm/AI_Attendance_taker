import {Camera, ScanFace, UserPlus} from 'lucide-react';

/** Landing page: the two things people come here to do. */
export function Home() {
  return (
    <div className="home">
      <header>
        <span className="brand"><span className="brand-icon"><ScanFace/></span>eigenroll<span className="brand-dot">.</span></span>
      </header>
      <main>
        <span className="eyebrow">BTI DS 2022 - 28</span>
        <h1>Classroom attendance</h1>
        <p className="lead">Take attendance from a photo or video, or register yourself so you can be recognised.</p>
        <div className="home-choices">
          <a className="home-choice primary-choice" href="/?page=attendance">
            <span className="home-icon"><Camera size={34}/></span>
            <strong>Take attendance</strong>
            <span>Take photos or a short video of the class and see who is present.</span>
          </a>
          <a className="home-choice" href="/?page=register">
            <span className="home-icon"><UserPlus size={34}/></span>
            <strong>Student registration</strong>
            <span>Enter your name and SAP ID and take a few face photos. About two minutes.</span>
          </a>
        </div>
      </main>
      <footer>EigenRoll · Face features + PCA / LDA attendance</footer>
    </div>
  );
}
