<?php
namespace MauticPlugin\FrankOwnerEntryBundle\Controller;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\RedirectResponse;
final class EntryController extends AbstractController
{
    /** This route is behind Mautic's /s/ firewall. Never accept a return URL. */
    public function returnAction(): RedirectResponse
    {
        return new RedirectResponse('/frank/bridge?app=campaigns&return=1', 302);
    }
}
